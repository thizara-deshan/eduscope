#include <gst/gst.h>
#include <gst/sdp/sdp.h>
#include <gst/webrtc/webrtc.h>
#include <json-glib/json-glib.h>
#include <glib-unix.h>
#include <signal.h>
#include <stdio.h>

static GstElement *pipeline, *peer;
static GMainLoop *loop;
static gchar *negotiation_id;

static void emit_json(const gchar *type, const gchar *key, const gchar *value,
                      const gchar *int_key, gint int_value) {
  JsonBuilder *b = json_builder_new();
  json_builder_begin_object(b);
  json_builder_set_member_name(b, "type"); json_builder_add_string_value(b, type);
  json_builder_set_member_name(b, "negotiation_id"); json_builder_add_string_value(b, negotiation_id ?: "");
  if (key) { json_builder_set_member_name(b, key); json_builder_add_string_value(b, value ?: ""); }
  if (int_key) { json_builder_set_member_name(b, int_key); json_builder_add_int_value(b, int_value); }
  json_builder_end_object(b);
  JsonGenerator *g = json_generator_new();
  JsonNode *root = json_builder_get_root(b);
  json_generator_set_root(g, root);
  gchar *text = json_generator_to_data(g, NULL);
  g_print("%s\n", text); fflush(stdout);
  g_free(text); json_node_free(root); g_object_unref(g); g_object_unref(b);
}

static void emit_error(const gchar *code, const gchar *message) {
  JsonBuilder *b = json_builder_new();
  json_builder_begin_object(b);
  json_builder_set_member_name(b, "type"); json_builder_add_string_value(b, "error");
  json_builder_set_member_name(b, "negotiation_id"); json_builder_add_string_value(b, negotiation_id ?: "");
  json_builder_set_member_name(b, "code"); json_builder_add_string_value(b, code);
  json_builder_set_member_name(b, "message"); json_builder_add_string_value(b, message);
  json_builder_end_object(b);
  JsonGenerator *g = json_generator_new(); JsonNode *root = json_builder_get_root(b);
  json_generator_set_root(g, root); gchar *text = json_generator_to_data(g, NULL);
  g_print("%s\n", text); fflush(stdout);
  g_free(text); json_node_free(root); g_object_unref(g); g_object_unref(b);
}

static gboolean is_host_candidate(const gchar *candidate) {
  return candidate && g_strrstr(candidate, " typ host") != NULL;
}

static void on_ice(GstElement *unused, guint mline, gchar *candidate, gpointer data) {
  if (negotiation_id && is_host_candidate(candidate))
    emit_json("ice", "candidate", candidate, "sdp_mline_index", (gint)mline);
}

static void answer_created(GstPromise *promise, gpointer data) {
  const GstStructure *reply = gst_promise_get_reply(promise);
  GstWebRTCSessionDescription *answer = NULL;
  if (reply) gst_structure_get(reply, "answer", GST_TYPE_WEBRTC_SESSION_DESCRIPTION, &answer, NULL);
  if (!answer) {
    emit_error("answer-failed", "create-answer returned no SDP");
  } else {
    g_signal_emit_by_name(peer, "set-local-description", answer, NULL);
    gchar *sdp = gst_sdp_message_as_text(answer->sdp);
    emit_json("answer", "sdp", sdp, NULL, 0);
    g_free(sdp); gst_webrtc_session_description_free(answer);
  }
  gst_promise_unref(promise);
}

static gboolean apply_message(gpointer data) {
  JsonNode *root = data;
  JsonObject *o = json_node_get_object(root);
  const gchar *type = json_object_get_string_member(o, "type");
  if (g_str_equal(type, "offer")) {
    g_free(negotiation_id);
    negotiation_id = g_strdup(json_object_get_string_member(o, "negotiation_id"));
    const gchar *text = json_object_get_string_member(o, "sdp");
    GstSDPMessage *sdp = NULL; gst_sdp_message_new(&sdp);
    if (gst_sdp_message_parse_buffer((const guint8 *)text, strlen(text), sdp) != GST_SDP_OK) {
      emit_error("invalid-sdp", "offer SDP could not be parsed");
      gst_sdp_message_free(sdp);
    } else {
      GstWebRTCSessionDescription *desc = gst_webrtc_session_description_new(GST_WEBRTC_SDP_TYPE_OFFER, sdp);
      GstPromise *remote = gst_promise_new();
      g_signal_emit_by_name(peer, "set-remote-description", desc, remote);
      gst_promise_wait(remote); gst_promise_unref(remote);
      gst_webrtc_session_description_free(desc);
      GstPromise *answer = gst_promise_new_with_change_func(answer_created, NULL, NULL);
      g_signal_emit_by_name(peer, "create-answer", NULL, answer);
    }
  } else if (g_str_equal(type, "ice")) {
    const gchar *candidate = json_object_get_string_member(o, "candidate");
    if (is_host_candidate(candidate)) {
      gint mline = json_object_has_member(o, "sdp_mline_index") ? json_object_get_int_member(o, "sdp_mline_index") : 0;
      g_signal_emit_by_name(peer, "add-ice-candidate", mline, candidate);
    }
  } else if (g_str_equal(type, "close")) {
    g_print("Got EOS\n"); fflush(stdout); g_main_loop_quit(loop);
  }
  json_node_free(root);
  return G_SOURCE_REMOVE;
}

static gpointer stdin_thread(gpointer data) {
  gchar *line = NULL; size_t cap = 0;
  while (getline(&line, &cap, stdin) >= 0) {
    JsonParser *p = json_parser_new();
    GError *error = NULL;
    if (json_parser_load_from_data(p, line, -1, &error)) {
      JsonNode *copy = json_node_copy(json_parser_get_root(p));
      g_main_context_invoke(NULL, apply_message, copy);
    } else { g_clear_error(&error); }
    g_object_unref(p);
  }
  free(line); return NULL;
}

static gboolean on_bus(GstBus *bus, GstMessage *message, gpointer data) {
  if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
    GError *error = NULL; gchar *debug = NULL;
    gst_message_parse_error(message, &error, &debug);
    if (negotiation_id) emit_error("pipeline-error", error->message);
    g_printerr("ERROR: %s %s\n", error->message, debug ?: "");
    g_clear_error(&error); g_free(debug); g_main_loop_quit(loop);
  } else if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_STATE_CHANGED && GST_MESSAGE_SRC(message) == GST_OBJECT(pipeline)) {
    GstState old, state, pending; gst_message_parse_state_changed(message, &old, &state, &pending);
    if (state == GST_STATE_PLAYING) { g_print("PLAYING\n"); fflush(stdout); }
  }
  return G_SOURCE_CONTINUE;
}

static gboolean stop_worker(gpointer data) {
  g_print("Got EOS\n"); fflush(stdout); g_main_loop_quit(loop); return G_SOURCE_REMOVE;
}

int main(int argc, char **argv) {
  gchar *graph = NULL;
  GOptionEntry entries[] = {{"graph", 0, 0, G_OPTION_ARG_STRING, &graph, "GStreamer graph", NULL}, {NULL}};
  GOptionContext *opts = g_option_context_new(NULL);
  g_option_context_add_main_entries(opts, entries, NULL);
  g_option_context_add_group(opts, gst_init_get_option_group());
  GError *error = NULL;
  if (!g_option_context_parse(opts, &argc, &argv, &error) || !graph) return 2;
  pipeline = gst_parse_launch(graph, &error);
  if (!pipeline) { g_printerr("ERROR: %s\n", error->message); return 2; }
  peer = gst_bin_get_by_name(GST_BIN(pipeline), "sendrecv");
  loop = g_main_loop_new(NULL, FALSE);
  g_signal_connect(peer, "on-ice-candidate", G_CALLBACK(on_ice), NULL);
  GstBus *bus = gst_element_get_bus(pipeline); gst_bus_add_watch(bus, on_bus, NULL);
  g_unix_signal_add(SIGINT, stop_worker, NULL);
  g_thread_new("stdin", stdin_thread, NULL);
  gst_element_set_state(pipeline, GST_STATE_PLAYING);
  g_main_loop_run(loop);
  gst_element_set_state(pipeline, GST_STATE_NULL);
  gst_element_get_state(pipeline, NULL, NULL, 2 * GST_SECOND);
  gst_object_unref(bus); gst_object_unref(peer); gst_object_unref(pipeline);
  g_main_loop_unref(loop); g_free(negotiation_id); g_option_context_free(opts);
  return 0;
}
