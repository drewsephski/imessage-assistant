import { z } from "zod";

const file = z.looseObject({ file_id: z.string().min(1).max(2048) });
// Preserve all provider fields when forwarding while validating the identity and
// attachment references used by ingress. Updates other than messages remain valid.
export const telegramUpdateSchema = z.looseObject({
  update_id: z.number().int().nonnegative(),
  message: z
    .looseObject({
      message_id: z.number().int().nonnegative(),
      chat: z.looseObject({
        id: z.number().int(),
        type: z.enum(["private", "group", "supergroup", "channel"]),
      }),
      from: z.looseObject({ id: z.number().int().positive() }).optional(),
      document: file.optional(),
      photo: z.array(file).max(100).optional(),
      audio: file.optional(),
      voice: file.optional(),
      video: file.optional(),
    })
    .optional(),
});

export const telegramAttachmentIds = (message: z.infer<typeof telegramUpdateSchema>["message"]) =>
  message
    ? [
        message.document,
        message.audio,
        message.voice,
        message.video,
        ...(message.photo ?? []),
      ].flatMap((attachment) => (attachment ? [attachment.file_id] : []))
    : [];
