# bareui-router
JavaScript Router for BareUI Core

## Description

A lightweight client-side router built on top of **bareui-core**. It supports:

* Declarative route definitions
* Dynamic route parameters such as `:id`
* Nested routes through recursive rendering
* Reactive navigation updates without full page reloads
* A simple `Link` component for SPA-style navigation

This router is designed for small to medium single-page applications that need a minimal and composable routing layer.

## Features

* **Reactive pathname tracking** — updates automatically when the browser URL changes.
* **Programmatic navigation** — use `navigate()` to move between routes.
* **Route parameters** — capture path segments like `/users/:id`.
* **Nested routing** — render child routes recursively.
* **Link component** — built-in anchor component that prevents full reloads.
* **Route matching cache** — compiled route patterns are reused for better performance.
* **Minimal API surface** — easy to integrate with BareUI Core components.

## Usage

### 1. Define your routes

```javascript
import { Router, Link, navigate } from './src/router';

const routes = [
  {
    path: '',
    component: ({ children }) => `
      <main>
        <h1>Home</h1>
        <nav>
          ${Link({ to: '/users', children: 'Users' })}
        </nav>
        ${children()}
      </main>
    `,
  },
  {
    path: 'users',
    component: ({ children }) => `
      <section>
        <h2>Users</h2>
        ${children()}
      </section>
    `,
    children: [
      {
        path: ':id',
        component: ({ params }) => `
          <article>
            <h3>User ID: ${params.id}</h3>
          </article>
        `,
      },
    ],
  },
];
```

### 2. Mount the router

```javascript
import { html, mount } from 'bareui-core';
import { Router } from './src/router';

const app = html`
    ${Router({ routes })}
`;

mount(document.getElementById('app'), app);
```

### 3. Navigate programmatically

```javascript
import { navigate } from './src/router';

navigate('/users/42');
```

### 4. Use the Link component

```javascript
import { Link } from './src/router';

const navItem = Link({
    to: '/users/42',
    children: 'Open User 42',
});
```

## How it works

The router performs the following steps:

1. Reads the current `window.location.pathname` from reactive router state.
2. Matches the current path against the configured route tree.
3. Extracts route parameters from dynamic segments.
4. Recursively renders nested child routes.
5. Listens to `popstate` so browser back/forward navigation stays in sync.

## License

MIT
