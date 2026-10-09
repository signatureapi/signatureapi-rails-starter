require "test_helper"

class SignatureapiWebhooksControllerTest < ActionDispatch::IntegrationTest
  test "a signed envelope.completed event completes the agreement" do
    deliver event("envelope.completed", agreements(:sent).envelope_id)

    assert_response :success
    assert agreements(:sent).reload.completed?
  end

  test "each tracked event sets its status" do
    { "recipient.rejected" => "rejected", "envelope.failed" => "failed", "envelope.canceled" => "canceled" }.each do |type, status|
      agreement = Agreement.create!(signer_name: "Ada", signer_email: "ada@example.com", envelope_id: "env-#{status}")

      deliver event(type, agreement.envelope_id)

      assert_equal status, agreement.reload.status
    end
  end

  test "a bad signature is rejected with 401 and changes nothing" do
    deliver event("envelope.completed", agreements(:sent).envelope_id), secret: "whsec_#{Base64.strict_encode64("some-other-secret")}"

    assert_response :unauthorized
    assert agreements(:sent).reload.sent?
  end

  test "an unsigned request is rejected with 401" do
    post "/webhooks/signatureapi", params: event("envelope.completed", agreements(:sent).envelope_id), headers: { "Content-Type" => "application/json" }

    assert_response :unauthorized
  end

  test "other event types are acknowledged and ignored" do
    deliver event("recipient.viewed", agreements(:sent).envelope_id)

    assert_response :success
    assert agreements(:sent).reload.sent?
  end

  test "an unknown envelope is acknowledged and ignored" do
    deliver event("envelope.completed", "99999999-9999-4999-8999-999999999999")

    assert_response :success
  end

  test "a late event does not change a finished agreement" do
    deliver event("envelope.canceled", agreements(:completed).envelope_id)

    assert_response :success
    assert agreements(:completed).reload.completed?
  end

  private
    def event(type, envelope_id)
      { id: "evt_#{SecureRandom.hex(8)}", type: type, timestamp: Time.current.iso8601,
        data: { envelope_id: envelope_id, object_id: envelope_id, object_type: "envelope" } }.to_json
    end

    # Signs the body the way SignatureAPI does, with the Standard Webhooks library.
    def deliver(body, secret: ENV.fetch("SIGNATUREAPI_WEBHOOK_SECRET"))
      id = "msg_#{SecureRandom.hex(8)}"
      timestamp = Time.now.to_i.to_s
      signature = StandardWebhooks::Webhook.new(secret).sign(id, timestamp, body)

      post "/webhooks/signatureapi", params: body, headers: {
        "Content-Type" => "application/json",
        "webhook-id" => id, "webhook-timestamp" => timestamp, "webhook-signature" => signature
      }
    end
end
