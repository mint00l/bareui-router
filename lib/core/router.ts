// ./lib/core/router.ts

import { reactive, component, html, type Renderable } from 'bareui-core';

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------
/**
 * Describes a single route definition used by the router.
 *
 * A route can optionally have nested child routes. When matched, its
 * `component` receives the extracted `params` and a `children()` function
 * that renders the next matched nested route, if any.
 */
export interface Route {
    path: string;
    component: (props: { params: Record<string, string>; children: () => Renderable }) => Renderable;
    children?: Route[];
}

// ----------------------------------------------------------------------
// Route compilation & matching
// ----------------------------------------------------------------------
/**
 * Internal compiled representation of a route pattern.
 *
 * The route path is converted into a regular expression plus an ordered
 * list of parameter names so matched values can be mapped back into
 * `params`.
 */
interface CompiledRoute {
    regex: RegExp;
    paramNames: string[];
}

/**
 * Cache of compiled route patterns keyed by the original route string.
 */
const routeCache = new Map<string, CompiledRoute>();

/**
 * Escapes a string so it can be safely embedded inside a regular expression.
 *
 * This is used to ensure static route segments are treated literally and
 * not as regex syntax.
 */
function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes a path by trimming leading and trailing slashes.
 *
 * This keeps route matching consistent regardless of how the caller
 * formats the path.
 */
function normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '');
}

/**
 * Splits a normalized route pattern into path segments.
 */
function splitPathSegments(pattern: string): string[] {
    const normalized = normalizePath(pattern);
    return normalized === '' ? [] : normalized.split('/');
}

/**
 * Returns a specificity tuple used to rank competing route matches.
 *
 * Higher values are more specific:
 * - more static segments wins
 * - deeper routes win next
 * - fewer dynamic params wins last
 */
function getRouteSpecificity(pattern: string): [number, number, number] {
    const segments = splitPathSegments(pattern);

    let staticCount = 0;
    let paramCount = 0;

    for (const segment of segments) {
        if (segment.startsWith(':')) {
            paramCount++;
        } else {
            staticCount++;
        }
    }

    return [staticCount, segments.length, -paramCount];
}

/**
 * Compares two specificity tuples.
 *
 * Returns a positive number when `a` is more specific than `b`.
 */
function compareRouteSpecificity(
    a: [number, number, number],
    b: [number, number, number]
): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    if (a[2] !== b[2]) return a[2] - b[2];
    return 0;
}

/**
 * Compiles a route pattern into a regular expression and parameter map.
 *
 * Dynamic segments in the form `:name` are converted into capture groups.
 * Static text is escaped so it matches literally. The compiled result is
 * cached for reuse.
 *
 * @param pattern - The route pattern to compile.
 * @returns The compiled regex and the ordered parameter names.
 */
function compileRoute(pattern: string): CompiledRoute {
    const cached = routeCache.get(pattern);
    if (cached) return cached;

    const paramNames: string[] = [];

    const escapedPattern = escapeRegex(pattern); 
    const regexPattern = escapedPattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
    });

    const regex = new RegExp(`^${regexPattern}(?=/|$)`);
    const compiled = { regex, paramNames };
    routeCache.set(pattern, compiled);
    return compiled;
}

/**
 * Attempts to match the first route in a route list against a path.
 *
 * Matching is segment-aware and returns both the matched route and the
 * remaining unconsumed path for nested routing.
 *
 * @param routes - The routes to search through.
 * @param path - The current path to match.
 * @returns The matched route, extracted params, and remaining path; or `null` if no route matches.
 */
function matchRoute(
    routes: Route[],
    path: string
): { route: Route; params: Record<string, string>; remainingPath: string } | null {
    let bestMatch: {
        route: Route;
        params: Record<string, string>;
        remainingPath: string;
        specificity: [number, number, number];
        order: number;
    } | null = null;
    
    const normalized = normalizePath(path);

    const indexRoute = routes.find(r => r.path === '');
    if (indexRoute && normalized === '') {
        return {
            route: indexRoute,
            params: {},
            remainingPath: '',
        };
    }

    for (let index = 0; index < routes.length; index++) {
        const route = routes[index];
        if (route.path === '') continue;
        const { regex, paramNames } = compileRoute(route.path);
        const match = regex.exec(normalized);
        if (match) {
            const matched = match[0];
            const remaining = normalized.slice(matched.length).replace(/^\/+/, '');
            const params: Record<string, string> = {};

            for (let i = 0; i < paramNames.length; i++) {
                params[paramNames[i]] = match[i + 1];
            }

            const specificity = getRouteSpecificity(route.path);
            const candidate = {
                route,
                params,
                remainingPath: remaining,
                specificity,
                order: index,
            };
            
            if (
                !bestMatch ||
                compareRouteSpecificity(candidate.specificity, bestMatch.specificity) > 0 ||
                (
                    compareRouteSpecificity(candidate.specificity, bestMatch.specificity) === 0 &&
                    candidate.order < bestMatch.order
                )
            ) {
                bestMatch = candidate;
            }
        }
    }
    
    return bestMatch
        ? {
            route: bestMatch.route,
            params: bestMatch.params,
            remainingPath: bestMatch.remainingPath,
        }
        : null;
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof window.history !== 'undefined';
}

function isSameOriginNavigation(to: string): boolean {
    if (!isBrowser()) return false;

    try {
        return new URL(to, window.location.href).origin === window.location.origin;
    } catch {
        return false;
    }
}

// ----------------------------------------------------------------------
// Reactive router state
// ----------------------------------------------------------------------
/**
 * Reactive router state shared by the router component and navigation API.
 */
type RouterState = {
    pathname: string;
};

const routerState = reactive<RouterState>({
    pathname: isBrowser() ? window.location.pathname : '',
});

let popstateSetup = false;

/**
 * Registers a single global `popstate` listener so browser back/forward
 * navigation updates reactive router state.
 *
 * This is idempotent and safe to call multiple times.
 */
function setupPopstate() {
    if (popstateSetup || !isBrowser()) return;
    popstateSetup = true;
    
    window.addEventListener('popstate', () => {
        routerState.pathname = window.location.pathname;
    });
}

// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------
/**
 * Programmatically navigates to a new route using the browser history API.
 *
 * This updates both the URL and the reactive router state so the UI rerenders.
 *
 * @param to - The destination path.
 */
export function navigate(to: string): void {
    if (!isBrowser()) {
        routerState.pathname = to;
        return;
    }
    
    window.history.pushState(null, '', to);
    routerState.pathname = to;
}

/**
 * Returns the shared reactive router state.
 *
 * Components can read `pathname` from this object to react to location changes.
 *
 * @returns The reactive router state.
 */
export function useRouter(): RouterState {
    return routerState;
}

/**
 * Link component that renders an anchor element and performs client-side navigation.
 *
 * The current implementation intercepts clicks and calls `navigate()` so
 * route changes happen without a full page reload.
 *
 * @param to - Target path to navigate to.
 * @param children - Link content.
 */
export const Link = component(({ to, children }: { to: string; children: Renderable }) => {
    const handleClick = (e: MouseEvent) => {
        const anchor = e.currentTarget as HTMLAnchorElement | null;

        if (!isBrowser()) return;
        if (e.defaultPrevented) return;
        if (e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (anchor?.target && anchor.target !== '_self') return;
        if (anchor?.hasAttribute('download')) return;
        if (!isSameOriginNavigation(to)) return;
        
        e.preventDefault();
        navigate(to);
    };
    return html`<a :href="${to}" @click="${handleClick}">${children}</a>`;
});

/**
 * Root router component that resolves the current path against a route tree.
 *
 * The router matches the current path, renders the matched route component,
 * and exposes a `children()` function for recursive nested routing.
 *
 * @param routes - The route tree to evaluate.
 * @param path - Optional path override used internally for nested routing.
 */
export const Router = component(({ routes, path }: { routes: Route[]; path?: string }): Renderable => {
    setupPopstate();
    const state = useRouter();

    return html`${() => {
        const currentPath = normalizePath(path ?? state.pathname);

        const match = matchRoute(routes, currentPath);
        if (!match) return null;

        const { route, params, remainingPath } = match;

        const children = (): Renderable => {
            if (!route.children || route.children.length === 0) return null;
            return html`${Router({ routes: route.children, path: remainingPath })}`;
        };

        return route.component({ params, children });
    }}`;
});