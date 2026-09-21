import { supabase } from "./supabase";
import { describeError } from "./errors";

/**
 * invoke() surfaces the HTTP error but keeps the body in error.context,
 * which is where our functions put their machine-readable error code.
 *
 * body is typed as a plain object, matching every call site here and
 * supabase-js's own request body type -- this is not validated against what
 * the target Edge Function actually expects, only against what invoke()'s
 * signature accepts.
 */
export async function callFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; message: string }> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (!error) return { data: data ?? null, message: "" };

  const context = (error as { context?: Response }).context;
  const code = context
    ? await context.clone().json().then((b) => b?.error ?? "").catch(() => "")
    : "";

  return { data: null, message: describeError({ code, message: error.message }) };
}
