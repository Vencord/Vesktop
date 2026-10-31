#
# SPDX-License-Identifier: GPL-3.0
# Vesktop, a desktop app aiming to give you a snappier Discord Experience
# Copyright (c) 2026 Vendicated and Vencord contributors
#

$ErrorActionPreference = "Stop"

if (-Not (Get-Module SignPath)) {
    Write-Host "Installing SignPath cmdlet..."

    Set-PSRepository PSGallery -InstallationPolicy Trusted
    Install-Module SignPath -Repository PSGallery
} else {
    Write-Host "SignPath cmdlet available"
}

Import-Module SignPath

Submit-SigningRequest `
  -OrganizationId "a425e071-26b7-4ccf-89fd-e045fa423475" -ProjectSlug "Vesktop" -ApiToken $Env:SIGNPATH_API_TOKEN `
  -SigningPolicySlug "test-signing" `
  -InputArtifactPath $Args[0] -OutputArtifactPath $Args[1] `
  -WaitForCompletion -WaitForCompletionTimeoutInSeconds 1800 `
  -Origin @{
    RepositoryData=@{
      SourceControlManagementType="git"
      Url="$Env:GITHUB_SERVER_URL/$Env:GITHUB_REPOSITORY.git"
      BranchName=$Env:GITHUB_REF_NAME
      CommitId=$Env:GITHUB_SHA
    }
    BuildData=@{
      Url="$Env:GITHUB_SERVER_URL/$Env:GITHUB_REPOSITORY/actions/runs/$Env:GITHUB_RUN_ID"
    }
  } `
  -Force # because electron-builder wants to do in-place signing
