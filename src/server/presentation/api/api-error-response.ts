import { NextResponse } from "next/server";

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export function createApiErrorResponse(params: {
  status: number;
  code: string;
  message: string;
}) {
  return NextResponse.json<ApiErrorPayload>(
    {
      code: params.code,
      message: params.message,
    },
    { status: params.status },
  );
}
