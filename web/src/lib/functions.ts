import { supabase } from "./supabase";
import { describeError } from "./errors";

/**
 * invoke() surfaces the HTTP error but keeps the body in error.context,
 * which is where our functions put their machine-readable error code.
 */
export async function callFunction<T>(
  name: string,
  body: unknown,
): Promise<{ data: T | null; message: string }> {
  // supabase-js types the request body as Record<string, any> | string | ...,
  // narrower than this function's public `unknown` -- every call site here
  // passes a plain JSON object, so the cast is safe in practice.
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body as Record<string, unknown>,
  });
  if (!error) return { data: data ?? null, message: "" };

  const context = (error as { context?: Response }).context;
  const code = context
    ? await context.clone().json().then((b) => b?.error ?? "").catch(() => "")
    : "";

  return { data: null, message: describeError({ code, message: error.message }) };
}
