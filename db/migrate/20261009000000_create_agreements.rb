class CreateAgreements < ActiveRecord::Migration[8.1]
  def change
    create_table :agreements do |t|
      t.string :signer_name, null: false
      t.string :signer_email, null: false
      t.string :envelope_id
      t.string :status, null: false, default: "sent"

      t.timestamps
    end
    add_index :agreements, :envelope_id, unique: true
  end
end
