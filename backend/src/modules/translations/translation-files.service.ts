import { Injectable } from '@nestjs/common'
import { Project } from '@prisma/client'
import { PrismaService } from '../../shared/prisma.service'
import { DEFAULT_SCOPE } from './limits'
import { mergeBrandFile } from './translation-merge'

/** Language files as served to SDKs and exported (flat, dot-notation keys). */
@Injectable()
export class TranslationFilesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Flache, zusammengeführte Datei. brandId null = Standard. Brand ohne diese Sprache → {}. */
  async getFile(input: {
    project: Project
    namespace: string
    language: string
    brandId: string | null
  }): Promise<Record<string, string>> {
    const { project, namespace, language, brandId } = input
    const empty = (): Record<string, string> => Object.create(null)
    if (!project.namespaces.includes(namespace)) return empty()

    // Languages are compared exactly as entered (pt-BR and pt-br differ).
    const projectHasLanguage = project.languages.includes(language)
    let scopes: string[]
    if (brandId === null) {
      if (!projectHasLanguage) return empty()
      scopes = [DEFAULT_SCOPE]
    } else {
      const brand = await this.prisma.brand.findFirst({
        where: { id: brandId, projectId: project.id },
        select: { id: true, languages: true },
      })
      if (!brand?.languages.includes(language)) return empty()
      // A brand-only language has no default texts to inherit.
      scopes = projectHasLanguage ? [DEFAULT_SCOPE, brandId] : [brandId]
    }

    const keys = await this.prisma.translationKey.findMany({
      where: { projectId: project.id, namespace },
      select: { id: true, key: true },
    })
    if (keys.length === 0) return empty()
    const keyById = new Map(keys.map((k) => [k.id, k.key]))

    // The only values query of this call.
    const values = await this.prisma.translationValue.findMany({
      where: {
        projectId: project.id,
        language,
        scope: { in: scopes },
        keyId: { in: keys.map((k) => k.id) },
      },
      select: { keyId: true, scope: true, value: true },
    })

    const defaults = empty()
    const overrides = empty()
    for (const v of values) {
      const key = keyById.get(v.keyId)
      if (key === undefined) continue
      if (v.scope === DEFAULT_SCOPE) defaults[key] = v.value
      else if (v.scope === brandId) overrides[key] = v.value
    }
    return brandId === null ? defaults : mergeBrandFile(defaults, overrides)
  }
}
