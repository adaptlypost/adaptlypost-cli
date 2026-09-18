class Adaptlypost < Formula
  desc "AdaptlyPost command line interface"
  homepage "https://adaptlypost.com"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/adaptlypost/adaptlypost-cli/releases/download/v#{version}/adaptlypost_#{version}_darwin_arm64.tar.gz"
      sha256 "aaaa"
    end
    on_intel do
      url "https://github.com/adaptlypost/adaptlypost-cli/releases/download/v#{version}/adaptlypost_#{version}_darwin_x64.tar.gz"
      sha256 "bbbb"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/adaptlypost/adaptlypost-cli/releases/download/v#{version}/adaptlypost_#{version}_linux_arm64.tar.gz"
      sha256 "cccc"
    end
    on_intel do
      url "https://github.com/adaptlypost/adaptlypost-cli/releases/download/v#{version}/adaptlypost_#{version}_linux_x64.tar.gz"
      sha256 "dddd"
    end
  end

  def install
    bin.install "adaptlypost"
    generate_completions_from_executable(bin/"adaptlypost", "completion")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/adaptlypost --version")
  end
end
