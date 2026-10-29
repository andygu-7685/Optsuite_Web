# Frontend

The Vite app uploads images to the FastAPI analysis service and displays the
result and overlay. Start the backend before using the app.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server. |
| `npm run build` | Builds the production bundle into `dist/`. |
| `npm run preview` | Serves the built `dist/` locally. |
| `npm run lint` | Lints the source with oxlint. |

Set `VITE_API_BASE_URL` to override the default backend URL,
`http://127.0.0.1:8000`.
