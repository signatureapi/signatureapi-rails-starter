require "net/http"

# The SignatureAPI REST client. There is no SDK: each call is plain HTTP with
# the X-API-Key header. The contract is https://spec.signatureapi.com/openapi.yaml
module SignatureApi
  BASE_URL = "https://api.signatureapi.com/v1"

  class Error < StandardError; end

  module_function

  # Uploads the raw file bytes and returns the temporary upload URL (kept for 24 hours).
  def upload_document(bytes)
    request(Net::HTTP::Post, "/uploads", body: bytes, content_type: "application/pdf").fetch("url")
  end

  # Creates an envelope with one signer. SignatureAPI emails the signing link
  # (`email_link`, the default ceremony), so the body sets no ceremony.
  def create_envelope(document_url:, signer_name:, signer_email:, agreement_id:)
    envelope = {
      title: "Sample agreement",
      documents: [ {
        format: "pdf",
        url: document_url,
        # Each place fills the [[key]] placeholder of the same name in the PDF.
        places: [ { key: "signer_signature", type: "signature", recipient_key: "signer" } ]
      } ],
      recipients: [ { type: "signer", key: "signer", name: signer_name, email: signer_email } ],
      metadata: { agreement_id: agreement_id.to_s }
    }
    request(Net::HTTP::Post, "/envelopes", body: envelope.to_json, content_type: "application/json")
  end

  # Deliverable URLs expire after an hour, so ask for them each time they are needed.
  def list_deliverables(envelope_id)
    request(Net::HTTP::Get, "/envelopes/#{envelope_id}/deliverables").fetch("data")
  end

  def request(method, path, body: nil, content_type: nil)
    uri = URI("#{BASE_URL}#{path}")
    req = method.new(uri, "X-API-Key" => ENV.fetch("SIGNATUREAPI_KEY"), "Accept" => "application/json")
    if body
      req.body = body
      req.content_type = content_type
    end

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |http| http.request(req) }
    json = response.content_type.to_s.include?("json") ? JSON.parse(response.body) : {}
    return json if response.is_a?(Net::HTTPSuccess)

    # Errors are RFC 9457 problem details: `detail` says what went wrong.
    raise Error, json["detail"] || json["title"] || "SignatureAPI returned HTTP #{response.code}"
  end
  private_class_method :request
end
