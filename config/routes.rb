Rails.application.routes.draw do
  root "agreements#index"

  resources :agreements, only: :create
  get "agreements/:id/signed.pdf", to: "agreements#signed_pdf", as: :signed_pdf_agreement, format: false

  post "webhooks/signatureapi", to: "signatureapi_webhooks#create"

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check
end
