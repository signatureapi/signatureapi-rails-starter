# Fail fast when the server starts without an API key. Tests, console and rake
# tasks do not need one.
Rails.application.config.after_initialize do
  if defined?(Rails::Server) && ENV["SIGNATUREAPI_KEY"].blank?
    abort "SIGNATUREAPI_KEY is not set. Run `npx --yes signatureapi init` to write a test key to .env."
  end
end
