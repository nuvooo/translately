import { generateObjectId } from '../shared/utils'

export type ProjectType = 'SINGLE' | 'MULTI'

export interface ProjectProps {
  id: string
  name: string
  key: string
  description: string | null
  type: ProjectType
  allowedOrigins: string[]
  /** Language codes of the project's standard texts, in display order. */
  languages: string[]
  namespaces: string[]
  organizationId: string
  createdAt: Date
  updatedAt: Date
}

export class Project {
  private constructor(private readonly props: ProjectProps) {}

  static create(
    props: Omit<
      ProjectProps,
      'id' | 'createdAt' | 'updatedAt' | 'languages' | 'namespaces'
    > &
      Partial<Pick<ProjectProps, 'languages' | 'namespaces'>>
  ): Project {
    const now = new Date()
    return new Project({
      ...props,
      languages: props.languages ?? [],
      // Same default as the database schema
      namespaces: props.namespaces ?? ['translation'],
      id: generateObjectId(),
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: ProjectProps): Project {
    return new Project(props)
  }

  get id() {
    return this.props.id
  }
  get name() {
    return this.props.name
  }
  get key() {
    return this.props.key
  }
  get description() {
    return this.props.description
  }
  get type() {
    return this.props.type
  }
  get allowedOrigins() {
    return [...this.props.allowedOrigins]
  }
  get languages() {
    return [...this.props.languages]
  }
  get namespaces() {
    return [...this.props.namespaces]
  }
  get organizationId() {
    return this.props.organizationId
  }
  get createdAt() {
    return this.props.createdAt
  }
  get updatedAt() {
    return this.props.updatedAt
  }
  get isMultiTenant() {
    return this.props.type === 'MULTI'
  }

  /**
   * The state lives in a private `props` field behind getters, which
   * JSON.stringify would not see (the API would answer `{ props: { ... } }`).
   * Serialise to the plain shape clients expect.
   */
  toJSON(): ProjectProps {
    return {
      ...this.props,
      allowedOrigins: [...this.props.allowedOrigins],
      languages: [...this.props.languages],
      namespaces: [...this.props.namespaces],
    }
  }

  update(data: {
    name?: string
    description?: string | null
    allowedOrigins?: string[]
  }): Project {
    return new Project({
      ...this.props,
      name: data.name ?? this.props.name,
      description: data.description ?? this.props.description,
      allowedOrigins: data.allowedOrigins ?? this.props.allowedOrigins,
      updatedAt: new Date(),
    })
  }

  isOriginAllowed(origin: string | null): boolean {
    if (
      this.props.allowedOrigins.length === 0 ||
      this.props.allowedOrigins.includes('*')
    ) {
      return true
    }
    if (!origin) return false

    try {
      const originDomain = new URL(origin).hostname
      return this.props.allowedOrigins.some((allowed) => {
        if (allowed === origin) return true
        if (originDomain === allowed || originDomain.endsWith('.' + allowed))
          return true
        if (allowed.startsWith('*.')) {
          const domain = allowed.slice(2)
          return originDomain === domain || originDomain.endsWith('.' + domain)
        }
        return false
      })
    } catch {
      return false
    }
  }
}
