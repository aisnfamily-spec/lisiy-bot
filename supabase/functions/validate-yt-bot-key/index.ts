// Supabase Edge Function: validate-yt-bot-key
// Deploy: supabase functions deploy validate-yt-bot-key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ valid: false, reason: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { key, hardwareId } = await req.json();

    if (!key || !hardwareId) {
      return new Response(
        JSON.stringify({ valid: false, reason: "missing_params" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find key
    const { data: row, error } = await supabase
      .from("yt_comment_bot_keys")
      .select("*")
      .eq("key", key.trim().toUpperCase())
      .eq("product", "yt-comment-bot")
      .single();

    if (error || !row) {
      return new Response(
        JSON.stringify({ valid: false, reason: "invalid_key" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!row.is_active) {
      return new Response(
        JSON.stringify({ valid: false, reason: "key_disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // First activation — bind to hardware
    if (!row.hardware_id) {
      await supabase
        .from("yt_comment_bot_keys")
        .update({ hardware_id: hardwareId })
        .eq("id", row.id);

      return new Response(
        JSON.stringify({ valid: true, activated: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check hardware match
    if (row.hardware_id !== hardwareId) {
      return new Response(
        JSON.stringify({ valid: false, reason: "key_bound_to_other_device" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ valid: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ valid: false, reason: "server_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
