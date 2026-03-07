# Local Admin Setup

To support image uploads from the Admin Dashboard, you must run the provided Node server instead of Vite:

1. \`npm install\`
2. \`node server.js\`
3. Visit \`http://localhost:3000\`

The Node server will serve the \`public/\` folder automatically just like Vite did, while also providing the \`/api/upload\` endpoint required by the Admin panel.
