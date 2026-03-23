// ./lib/core/router.ts

import { reactive, component, html, type Renderable } from 'bareui-core';

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export interface Route {
    path: string;
    component: (props: { params: Record<string, string>; children: () => Renderable }) => Renderable;
    children?: Route[];
}

// ----------------------------------------------------------------------
// Route compilation & matching
// ----------------------------------------------------------------------

interface CompiledRoute {
    regex: RegExp;
    paramNames: string[];
}

const routeCache = new Map<string, CompiledRoute>();

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '');
}

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

function matchRoute(
    routes: Route[],
    path: string
): { route: Route; params: Record<string, string>; remainingPath: string } | null {
    const normalized = normalizePath(path);

    const indexRoute = routes.find(r => r.path === '');
    if (indexRoute && normalized === '') {
        return {
            route: indexRoute,
            params: {},
            remainingPath: '',
        };
    }

    for (const route of routes) {
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
            return { route, params, remainingPath: remaining };
        }
    }
    return null;
}

// ----------------------------------------------------------------------
// Reactive router state
// ----------------------------------------------------------------------

type RouterState = {
    pathname: string;
};

const routerState = reactive<RouterState>({
    pathname: window.location.pathname,
});

let popstateSetup = false;

function setupPopstate() {
    if (popstateSetup) return;
    popstateSetup = true;
    window.addEventListener('popstate', () => {
        routerState.pathname = window.location.pathname;
    });
}

// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------

export function navigate(to: string): void {
    window.history.pushState(null, '', to);
    routerState.pathname = to;
}

export function useRouter(): RouterState {
    return routerState;
}

/**
 * Link component – renders an `<a>` that triggers navigation on click.
 */
export const Link = component(({ to, children }: { to: string; children: Renderable }) => {
    const handleClick = (e: MouseEvent) => {
        e.preventDefault();
        navigate(to);
    };
    return html`<a :href="${to}" @click="${handleClick}">${children}</a>`;
});

/**
 * Router component – recursively renders the matched route tree.
 * The matching logic is placed inside a function that is re‑evaluated whenever the URL changes.
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