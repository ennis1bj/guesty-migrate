import { z } from 'zod';

export const migrationRequestSchema = z.object({
  sourceClientId:     z.string().min(1, 'sourceClientId is required'),
  sourceClientSecret: z.string().min(1, 'sourceClientSecret is required'),
  sourceEmail:        z.string().email('sourceEmail must be a valid email address'),
  sourcePassword:     z.string().min(1, 'sourcePassword is required'),
  destEmail:          z.string().email('destEmail must be a valid email address'),
  destPassword:       z.string().min(1, 'destPassword is required'),
});

export type MigrationRequest = z.infer<typeof migrationRequestSchema>;
