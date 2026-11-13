import { Prisma } from '@prisma/client'

type CleanupClient = Pick<
  Prisma.TransactionClient,
  | 'apiKey'
  | 'configVersion'
  | 'webhook'
  | 'webhookDelivery'
  | 'translationValue'
  | 'translationKey'
>

/**
 * Removes the data that hangs off a project: its translations (values, then
 * keys), configuration versions, webhooks and their deliveries, and the MCP keys bound to it. MongoDB has
 * no cascading deletes, so every place that deletes a project must call this
 * before deleting the project row.
 */
export async function deleteProjectChangeData(
  db: CleanupClient,
  projectId: string
): Promise<void> {
  // Values are deleted explicitly instead of relying on Prisma's emulated cascade.
  await db.translationValue.deleteMany({ where: { projectId } })
  await db.translationKey.deleteMany({ where: { projectId } })

  await db.apiKey.deleteMany({ where: { projectId, type: 'MCP' } })

  await db.configVersion.deleteMany({ where: { projectId } })

  const webhooks = await db.webhook.findMany({
    where: { projectId },
    select: { id: true },
  })
  if (webhooks.length > 0) {
    await db.webhookDelivery.deleteMany({
      where: { webhookId: { in: webhooks.map((w) => w.id) } },
    })
  }
  await db.webhook.deleteMany({ where: { projectId } })
}
