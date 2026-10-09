ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require "webmock/minitest"

# Tests never reach SignatureAPI: WebMock blocks real HTTP, and these values
# replace whatever is in .env.
ENV["SIGNATUREAPI_KEY"] = "key_test_example"
ENV["SIGNATUREAPI_WEBHOOK_SECRET"] = "whsec_#{Base64.strict_encode64("test-webhook-secret-32-bytes-ok!")}"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end
