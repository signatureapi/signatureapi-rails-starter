class AgreementsController < ApplicationController
  SAMPLE_DOCUMENT = Rails.root.join("app/documents/sample-agreement.pdf")

  def index
    @agreements = Agreement.newest_first
  end

  def create
    agreement = Agreement.new(params.permit(:signer_name, :signer_email))

    # The envelope metadata carries the local id, so save first and roll back
    # if SignatureAPI refuses the envelope.
    Agreement.transaction do
      agreement.save!
      document_url = SignatureApi.upload_document(SAMPLE_DOCUMENT.binread)
      envelope = SignatureApi.create_envelope(
        document_url: document_url,
        signer_name: agreement.signer_name,
        signer_email: agreement.signer_email,
        agreement_id: agreement.id
      )
      agreement.update!(envelope_id: envelope.fetch("id"))
    end

    redirect_to root_path
  rescue SignatureApi::Error, ActiveRecord::RecordInvalid => error
    @error = error.message
    @agreements = Agreement.newest_first
    render :index, status: :unprocessable_entity
  end

  def signed_pdf
    agreement = Agreement.find(params[:id])
    url = SignatureApi.list_deliverables(agreement.envelope_id).first&.dig("url")

    if url
      redirect_to url, allow_other_host: true
    else
      render plain: "The signed PDF is not ready yet.", status: :not_found
    end
  end
end
