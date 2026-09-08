import { RouterProvider } from "react-router";

import { router } from "@/app/router";

/**
 * Application root. Wires the router created in
 * `src/app/router.tsx` and nothing else — the repo, toasts and layout are
 * attached at the root level of every route so navigating between pages does
 * not remount them.
 */
export default function App() {
  return <RouterProvider router={router} />;
}
