/**
 * UI Bridge API Route Handler
 *
 * This catch-all route handles all UI Bridge HTTP requests.
 * In a real application, you would use ui-bridge-server/nextjs.
 * For this example, we implement a simple mock handler.
 */

import { NextRequest, NextResponse } from 'next/server';

// This is a placeholder - in a real app, use:
// import { createNextHandler } from 'ui-bridge-server/nextjs';
// const handler = createNextHandler({ features: { control: true } });
// export const GET = handler;
// export const POST = handler;

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api/ui-bridge', '');

  // Health check
  if (path === '/health') {
    return NextResponse.json({
      success: true,
      data: { status: 'ok' },
      timestamp: Date.now(),
    });
  }

  // Mock response for other endpoints
  return NextResponse.json({
    success: true,
    data: { message: `GET ${path} - UI Bridge endpoint placeholder` },
    timestamp: Date.now(),
  });
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api/ui-bridge', '');
  const body = await request.json().catch(() => ({}));

  // Mock response
  return NextResponse.json({
    success: true,
    data: {
      message: `POST ${path} - UI Bridge endpoint placeholder`,
      received: body,
    },
    timestamp: Date.now(),
  });
}

export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api/ui-bridge', '');

  return NextResponse.json({
    success: true,
    data: { message: `DELETE ${path} - UI Bridge endpoint placeholder` },
    timestamp: Date.now(),
  });
}
