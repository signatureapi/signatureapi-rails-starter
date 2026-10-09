class Agreement < ApplicationRecord
  enum :status, {
    sent: "sent",
    completed: "completed",
    rejected: "rejected",
    failed: "failed",
    canceled: "canceled"
  }, default: :sent, validate: true

  validates :signer_name, :signer_email, presence: true

  scope :newest_first, -> { order(created_at: :desc, id: :desc) }

  # Every status but `sent` is final.
  def finished?
    !sent?
  end

  # Webhooks can arrive late or out of order, so a finished agreement keeps its status.
  def record_outcome(new_status)
    update!(status: new_status) unless finished?
  end
end
