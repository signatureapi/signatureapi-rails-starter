require "test_helper"

class AgreementsControllerTest < ActionDispatch::IntegrationTest
  JSON_HEADERS = { "Content-Type" => "application/json" }.freeze

  test "index lists agreements and links the signed PDF of completed ones" do
    get root_path

    assert_response :success
    assert_select "tr[data-envelope-id='#{agreements(:sent).envelope_id}'] [data-status='sent']", "Sent"
    assert_select "a[href='/agreements/#{agreements(:completed).id}/signed.pdf']", "Signed PDF"
    assert_select "a", text: "Signed PDF", count: 1
  end

  test "create uploads the PDF, creates the envelope and saves the agreement" do
    stub_request(:post, "https://api.signatureapi.com/v1/uploads")
      .with(headers: { "Content-Type" => "application/pdf" })
      .to_return(status: 201, body: { url: "https://files.example/upload.pdf" }.to_json, headers: JSON_HEADERS)
    stub_request(:post, "https://api.signatureapi.com/v1/envelopes")
      .with { |request| JSON.parse(request.body).dig("documents", 0, "url") == "https://files.example/upload.pdf" }
      .to_return(status: 201, body: { id: "env-new" }.to_json, headers: JSON_HEADERS)

    assert_difference "Agreement.count", 1 do
      post agreements_path, params: { signer_name: "Grace Hopper", signer_email: "grace@example.com" }
    end

    assert_redirected_to root_path
    agreement = Agreement.find_by!(envelope_id: "env-new")
    assert_equal [ "Grace Hopper", "grace@example.com", "sent" ], [ agreement.signer_name, agreement.signer_email, agreement.status ]
    assert_requested(:post, "https://api.signatureapi.com/v1/envelopes") { |request| JSON.parse(request.body).dig("metadata", "agreement_id") == agreement.id.to_s }
  end

  test "create shows the API error and saves nothing" do
    stub_request(:post, "https://api.signatureapi.com/v1/uploads")
      .to_return(status: 201, body: { url: "https://files.example/upload.pdf" }.to_json, headers: JSON_HEADERS)
    stub_request(:post, "https://api.signatureapi.com/v1/envelopes")
      .to_return(status: 422, body: { title: "Unprocessable", detail: "Recipient email is not valid." }.to_json,
                 headers: { "Content-Type" => "application/problem+json" })

    assert_no_difference "Agreement.count" do
      post agreements_path, params: { signer_name: "Grace Hopper", signer_email: "grace@example.com" }
    end

    assert_response :unprocessable_entity
    assert_select "p.error[role=alert]", "Could not create the envelope: Recipient email is not valid."
  end

  test "signed.pdf redirects to a fresh deliverable URL" do
    agreement = agreements(:completed)
    stub_request(:get, "https://api.signatureapi.com/v1/envelopes/#{agreement.envelope_id}/deliverables")
      .to_return(status: 200, body: { data: [ { status: "generated", url: "https://files.example/signed.pdf" } ] }.to_json, headers: JSON_HEADERS)

    get "/agreements/#{agreement.id}/signed.pdf"

    assert_redirected_to "https://files.example/signed.pdf"
  end

  test "signed.pdf is 404 while the deliverable is not ready" do
    agreement = agreements(:completed)
    stub_request(:get, "https://api.signatureapi.com/v1/envelopes/#{agreement.envelope_id}/deliverables")
      .to_return(status: 200, body: { data: [ { status: "processing", url: nil } ] }.to_json, headers: JSON_HEADERS)

    get "/agreements/#{agreement.id}/signed.pdf"

    assert_response :not_found
  end
end
