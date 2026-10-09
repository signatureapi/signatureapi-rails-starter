class SignatureapiWebhooksController < ApplicationController
  # SignatureAPI signs each delivery (Standard Webhooks); it sends no CSRF token.
  skip_forgery_protection

  STATUS_BY_EVENT = {
    "envelope.completed" => "completed",
    "recipient.rejected" => "rejected",
    "envelope.failed" => "failed",
    "envelope.canceled" => "canceled"
  }.freeze

  def create
    # The signature covers the exact bytes sent, so verify the raw body, not params.
    event = webhook.verify(request.raw_post, request.headers)

    status = STATUS_BY_EVENT[event["type"]]
    if status
      # Events carry ids only: find the agreement by the envelope id it stored.
      Agreement.find_by(envelope_id: event.dig("data", "envelope_id"))&.record_outcome(status)
    end

    head :ok
  rescue StandardWebhooks::StandardWebhooksError
    head :unauthorized
  end

  private
    def webhook
      StandardWebhooks::Webhook.new(ENV.fetch("SIGNATUREAPI_WEBHOOK_SECRET"))
    end
end
