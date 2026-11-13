import { Navigate, useLocation, useParams } from 'react-router-dom'

/**
 * Redirects to `to`, replacing `:param` placeholders with current params.
 * Query string and hash of the old URL are kept.
 */
export function ParamRedirect({ to }: { to: string }) {
  const params = useParams()
  const { search, hash } = useLocation()
  const pathname = to.replace(
    /:([A-Za-z]+)/g,
    (_, name: string) => params[name] ?? ''
  )
  return <Navigate to={{ pathname, search, hash }} replace />
}
