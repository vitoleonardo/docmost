import { HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';

export function abortedWhenClientLeaves(reply: FastifyReply): AbortSignal {
  const clientGone = new AbortController();
  reply.raw.on('close', () => clientGone.abort());
  return clientGone.signal;
}

export async function streamServerSentEvents(
  reply: FastifyReply,
  open: (signal: AbortSignal) => Promise<AsyncIterable<object> | null>,
): Promise<void> {
  const events = await open(abortedWhenClientLeaves(reply));
  if (!events) return;

  reply.hijack();
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) reply.raw.setHeader(name, value);
  }
  reply.raw.writeHead(HttpStatus.OK, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no',
  });
  for await (const event of events) {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  reply.raw.end();
}
