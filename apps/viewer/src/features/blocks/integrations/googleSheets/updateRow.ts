import {
  SessionState,
  GoogleSheetsUpdateRowOptions,
  ReplyLog,
} from '@typebot.io/schemas'
import { parseCellValues } from './helpers/parseCellValues'
import { getAuthenticatedGoogleDoc } from './helpers/getAuthenticatedGoogleDoc'
import { deepParseVariables } from '@/features/variables/deepParseVariable'
import { ExecuteIntegrationResponse } from '@/features/chat/types'
import { saveErrorLog } from '@/features/logs/saveErrorLog'
import { saveSuccessLog } from '@/features/logs/saveSuccessLog'
import { TRPCError } from '@trpc/server'

export const updateRow = async (
  { result, typebot: { variables } }: SessionState,
  {
    outgoingEdgeId,
    options,
  }: { outgoingEdgeId?: string; options: GoogleSheetsUpdateRowOptions }
): Promise<ExecuteIntegrationResponse> => {
  const { sheetId, referenceCell } = deepParseVariables(variables)(options)
  if (!options.cellsToUpsert || !sheetId || !referenceCell)
    return { outgoingEdgeId }

  let log: ReplyLog | undefined

  const doc = await getAuthenticatedGoogleDoc({
    credentialsId: options.credentialsId,
    spreadsheetId: options.spreadsheetId,
  })

  const parsedValues = parseCellValues(variables)(options.cellsToUpsert)

  await doc.loadInfo()
  const sheet = doc.sheetsById[sheetId]
  const rows = await sheet.getRows()
  const updatingRowIndex = rows.findIndex(
    (row) => row[referenceCell.column as string] === referenceCell.value
  )
  if (updatingRowIndex === -1) {
    log = {
      status: 'error',
      description: `Could not find row to update`,
      details: `Looked for row with ${referenceCell.column} equals to "${referenceCell.value}"`,
    }
    result &&
      (await saveErrorLog({
        resultId: result.id,
        message: log.description,
        details: log.details,
      }))
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Couldn't find row with ${referenceCell.column} that equals to "${referenceCell.value}"`,
    })
  }

  for (const key in parsedValues) {
    rows[updatingRowIndex][key] = parsedValues[key]
  }

  try {
    await rows[updatingRowIndex].save()
    log = log = {
      status: 'success',
      description: `Succesfully updated row in ${doc.title} > ${sheet.title}`,
    }
    result &&
      (await saveSuccessLog({
        resultId: result.id,
        message: log.description,
      }))
  } catch (err) {
    log = {
      status: 'error',
      description: `An error occured while updating the row`,
      details: err,
    }
    result &&
      (await saveErrorLog({
        resultId: result.id,
        message: log.description,
        details: err,
      }))
  }
  return { outgoingEdgeId, logs: log ? [log] : undefined }
}
