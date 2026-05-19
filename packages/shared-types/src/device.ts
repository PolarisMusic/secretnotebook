import { z } from 'zod';

const HexString = (bytes: number) =>
  z
    .string()
    .regex(/^[0-9a-f]+$/i, 'must be lowercase hex')
    .length(bytes * 2, `must encode exactly ${bytes} bytes`);

export const DeviceRegisterSchema = z.object({
  pubkey: HexString(32),
});
export type DeviceRegister = z.infer<typeof DeviceRegisterSchema>;

export const DeviceRegisterResponseSchema = z.object({
  ok: z.literal(true),
});
export type DeviceRegisterResponse = z.infer<typeof DeviceRegisterResponseSchema>;
