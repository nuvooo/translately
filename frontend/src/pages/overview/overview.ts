import { useCallback, useEffect, useRef, useState } from 'react'
import api from '@/lib/axios'

/** Response of `GET /overview` (only the caller's organizations). */
export interface OverviewData {
  counts: {
    organizations: number
    projects: number
  }
  projects: {
    id: string
    name: string
    key: string
    type: 'SINGLE' | 'MULTI'
    organizationId: string
    organizationName: string
    brandCount: number
    /** Translation keys of all namespaces. */
    keyCount: number
    /** Number of project languages. */
    languageCount: number
    /** Missing standard texts over all keys and languages. */
    missingCount: number
    updatedAt: string
  }[]
}

export type OverviewProject = OverviewData['projects'][number]

export async function fetchOverview(): Promise<OverviewData> {
  const { data } = await api.get<OverviewData>('/overview')
  return data
}

/** Loads the overview; `reload` retries after an error. */
export function useOverview() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const loadId = useRef(0)

  const reload = useCallback(async () => {
    const id = ++loadId.current
    setIsLoading(true)
    setError(false)
    try {
      const loaded = await fetchOverview()
      if (id === loadId.current) setData(loaded)
    } catch {
      if (id === loadId.current) setError(true)
    } finally {
      if (id === loadId.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    return () => {
      // Drop results that arrive after unmount
      loadId.current++
    }
  }, [reload])

  return { data, error, isLoading, reload }
}
