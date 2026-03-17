from flask import Blueprint, Response, jsonify, request

from services.chat_service import create_chat_stream_response

chat_bp = Blueprint("chat", __name__)


@chat_bp.route("/api/chat", methods=["POST"])
def chat_route():
    data = request.get_json(silent=True) or {}
    response_or_error = create_chat_stream_response(data)

    if isinstance(response_or_error, tuple):
        body, status_code = response_or_error
        return jsonify(body), status_code

    return Response(
        response_or_error,
        mimetype="text/plain; charset=utf-8",
    )