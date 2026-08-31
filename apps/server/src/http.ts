import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '@sns/domain';
import { fail } from '@sns/contracts';
export function sendError(req: FastifyRequest, reply: FastifyReply, err: unknown) {
  const requestId =
    (
      req as FastifyRequest & {
        requestId?: string;
      }
    ).requestId ?? 'unknown';
  if (err instanceof ZodError) {
    return reply.status(400).send(
      fail(
        requestId,
        'VALIDATION',
        'Some fields could not be read.',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      ),
    );
  }
  if (err instanceof DomainError) {
    return reply.status(err.httpStatus).send(fail(requestId, err.code, err.message, err.details));
  }
  const status = (
    err as {
      httpStatus?: number;
    }
  ).httpStatus;
  if (status === 403) {
    return reply
      .status(403)
      .send(fail(requestId, 'FORBIDDEN', 'You do not have permission to view this.'));
  }
  req.log.error(err);
  return reply
    .status(500)
    .send(
      fail(
        requestId,
        'INTERNAL',
        'Something went wrong. Quote this request id if you contact support.',
      ),
    );
}
