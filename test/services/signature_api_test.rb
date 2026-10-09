require "test_helper"

class SignatureApiTest < ActiveSupport::TestCase
  test "upload_document posts the raw PDF bytes and returns the upload url" do
    stub_request(:post, "https://api.signatureapi.com/v1/uploads")
      .with(body: "%PDF-1.7", headers: { "Content-Type" => "application/pdf", "X-API-Key" => "key_test_example" })
      .to_return(status: 201, body: { url: "https://files.example/upload.pdf" }.to_json, headers: { "Content-Type" => "application/json" })

    assert_equal "https://files.example/upload.pdf", SignatureApi.upload_document("%PDF-1.7")
  end

  test "create_envelope sends one signer and one signature place" do
    expected_body = {
      title: "Sample agreement",
      documents: [ {
        format: "pdf",
        url: "https://files.example/upload.pdf",
        places: [ { key: "signer_signature", type: "signature", recipient_key: "signer" } ]
      } ],
      recipients: [ { type: "signer", key: "signer", name: "Ada Lovelace", email: "ada@example.com" } ],
      metadata: { agreement_id: "42" }
    }
    stub_request(:post, "https://api.signatureapi.com/v1/envelopes")
      .with(body: expected_body.to_json, headers: { "Content-Type" => "application/json", "X-API-Key" => "key_test_example" })
      .to_return(status: 201, body: { id: "env-1" }.to_json, headers: { "Content-Type" => "application/json" })

    envelope = SignatureApi.create_envelope(
      document_url: "https://files.example/upload.pdf", signer_name: "Ada Lovelace", signer_email: "ada@example.com", agreement_id: 42
    )

    assert_equal "env-1", envelope["id"]
  end

  test "list_deliverables returns the data array" do
    stub_request(:get, "https://api.signatureapi.com/v1/envelopes/env-1/deliverables")
      .to_return(status: 200, body: { data: [ { url: "https://files.example/signed.pdf" } ] }.to_json, headers: { "Content-Type" => "application/json" })

    assert_equal [ { "url" => "https://files.example/signed.pdf" } ], SignatureApi.list_deliverables("env-1")
  end

  test "an error response raises with the problem detail" do
    stub_request(:post, "https://api.signatureapi.com/v1/uploads")
      .to_return(status: 401, body: { title: "Unauthorized", detail: "The API key is not valid." }.to_json, headers: { "Content-Type" => "application/problem+json" })

    error = assert_raises(SignatureApi::Error) { SignatureApi.upload_document("%PDF-1.7") }
    assert_equal "The API key is not valid.", error.message
  end
end
