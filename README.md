# Capybara Onsen — Interactive Portfolio

A lazy capybara explores a pixel-art onsen village. Each hot spring pool hides a project to discover.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
```

## Production Build

```bash
npm run build    # outputs to dist/
npx vite preview # local preview of production build
```

## Deploy to Vercel

```bash
npx vercel       # first time: follow prompts to link
npx vercel --prod  # production deploy
```

Or connect the GitHub repo in Vercel dashboard for auto-deploy.

## Adding Projects

Edit `src/projects.js` and add an entry:

```js
{
  id: 'myproject',
  name: 'MY PROJECT',
  description: 'One-line description.',
  tags: ['Tag1', 'Tag2'],
  link: 'https://example.com',
  position: [x, 0, z],
}
```

A gate + stamp slot is auto-generated for the nearest available onsen.

## Controls

- **WASD / Arrow keys** — Move
- **Space** — Jump
- **E / Enter** — View project (near gate)
- **C** — Debug colliders
- **☀/☾ button** — Day/Night toggle
- **Mobile** — Touch D-pad + Jump button
