import { z } from 'zod';
import { ITEM_CATEGORIES, STORAGE_STATES } from '@/lib/domain';
import { SUPPORTED_UNITS } from '@/lib/units';

/**
 * The contract the vision model must satisfy. Parsed before anything is persisted — model output
 * is untrusted input.
 */

export const extractedItemSchema = z.object({
  name: z.string().min(1).max(120).describe('The item as written or seen, kept in the original wording'),
  category: z.enum(ITEM_CATEGORIES).describe('Exactly one allowed category'),
  quantity: z.number().min(0).describe('Numeric quantity in the chosen unit'),
  unit: z.enum(SUPPORTED_UNITS).describe('Unit of the quantity'),
  estimatedMassG: z
    .number()
    .min(0)
    .describe('Total mass in grams. Required for counted units; 0 if genuinely unjudgeable'),
  isCooked: z.boolean().describe('True for already-prepared food'),
  storageHint: z.enum(STORAGE_STATES).describe('Where this is most likely being kept'),
  confidence: z.number().min(0).max(1).describe('Honest confidence in the item and its quantity'),
});

export const extractionResultSchema = z.object({
  isReceipt: z.boolean().describe('True if the image is a receipt rather than the food itself'),
  note: z.string().max(300).describe('One short sentence on what the image shows'),
  items: z.array(extractedItemSchema).max(40),
});

export type ExtractedItem = z.infer<typeof extractedItemSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
