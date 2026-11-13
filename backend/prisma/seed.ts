import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

const DEMO_TRANSLATIONS: Record<string, Record<string, string>> = {
  'checkout.title': { de: 'Kasse', en: 'Checkout' },
  'checkout.submit': { de: 'Jetzt kaufen', en: 'Buy now' },
  'cart.empty': { de: 'Ihr Warenkorb ist leer', en: 'Your cart is empty' },
}

// Only called for a freshly created demo project (the seed is a no-op on re-run).
async function seedTranslations(
  organizationId: string,
  projectId: string,
  userId: string
) {
  await prisma.project.update({
    where: { id: projectId },
    data: { languages: ['de', 'en'] },
  })

  for (const [key, texts] of Object.entries(DEMO_TRANSLATIONS)) {
    const translationKey = await prisma.translationKey.upsert({
      where: {
        projectId_namespace_key: { projectId, namespace: 'translation', key },
      },
      update: {},
      create: {
        projectId,
        organizationId,
        namespace: 'translation',
        key,
        createdById: userId,
      },
    })

    for (const [language, value] of Object.entries(texts)) {
      await prisma.translationValue.upsert({
        where: {
          keyId_language_scope: {
            keyId: translationKey.id,
            language,
            scope: 'default',
          },
        },
        update: {},
        create: {
          keyId: translationKey.id,
          projectId,
          language,
          scope: 'default',
          value,
          updatedById: userId,
        },
      })
    }
  }

  console.log('Seeded demo translations')
}

async function main() {
  console.log('🌱 Seeding database...')

  // Check if demo user exists
  const existingUser = await prisma.user.findUnique({
    where: { email: 'demo@translately.io' },
  })

  if (existingUser) {
    console.log('Demo user already exists, skipping seed')
    return
  }

  // Create demo user
  const hashedPassword = await hashPassword('demo123!')

  const user = await prisma.user.create({
    data: {
      email: 'demo@translately.io',
      password: hashedPassword,
      firstName: 'Demo',
      lastName: 'User',
    },
  })

  console.log('Created demo user:', user.email)

  // Create organization
  const org = await prisma.organization.create({
    data: {
      name: 'Demo Organization',
      slug: 'demo-organization',
      description: 'A demo organization for testing',
    },
  })

  console.log('Created organization:', org.name)

  // Add user as owner
  await prisma.organizationMember.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      role: 'OWNER',
    },
  })

  // Create project
  const project = await prisma.project.create({
    data: {
      name: 'Demo Project',
      key: 'demo-project',
      description: 'A demo project',
      organizationId: org.id,
    },
  })

  console.log('Created project:', project.name)

  await seedTranslations(org.id, project.id, user.id)

  // Create a demo API key
  const apiKey = await prisma.apiKey.create({
    data: {
      name: 'Demo API Key',
      key: 'translately_demo_sdk_key_for_testing_purposes_only',
      type: 'CLIENT',
      organizationId: org.id,
      userId: user.id,
    },
  })

  console.log('Created API key:', apiKey.name)

  console.log('✅ Seed completed successfully!')
  console.log('')
  console.log('Demo credentials:')
  console.log('  Email: demo@translately.io')
  console.log('  Password: demo123!')
  console.log('')
  console.log('Demo API Key: translately_demo_sdk_key_for_testing_purposes_only')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
