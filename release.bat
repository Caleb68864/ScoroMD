@echo off
echo ScoroMD - Release Generator
echo =========================

REM Read version from package.json using findstr
for /f "tokens=2 delims=:," %%a in ('findstr "version" package.json') do (
  set VERSION=%%a
)

REM Remove quotes and spaces
set VERSION=%VERSION:"=%
set VERSION=%VERSION: =%

echo Creating release for version %VERSION%

REM Ask user if they want to create a local release or trigger GitHub workflow
echo.
echo Release options:
echo 1. Create local release only
echo 2. Create local release and trigger GitHub workflow
echo 3. Trigger GitHub workflow only
echo.
set /p OPTION="Select option (1-3): "

if "%OPTION%"=="1" goto :local
if "%OPTION%"=="2" goto :both
if "%OPTION%"=="3" goto :github
echo Invalid option. Exiting.
exit /b 1

:both
echo.
echo Creating both local release and triggering GitHub workflow...
goto :local

:local
echo.
echo Creating local release...

REM Create releases directory if it doesn't exist
if not exist "releases" mkdir releases

REM Clean previous build files
echo Cleaning previous build...
call npm run clean

REM Build the project
echo Building project...
call npm run build

REM Create the release directory
set RELEASE_DIR=releases\scoro-md-%VERSION%
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"

REM Copy required files to the release directory
echo Copying files to release directory...
copy main.js "%RELEASE_DIR%\"
copy manifest.json "%RELEASE_DIR%\"
copy styles.css "%RELEASE_DIR%\"
copy README.md "%RELEASE_DIR%\"
copy LICENSE "%RELEASE_DIR%\"

REM Create zip file
echo Creating zip file...
cd releases
if exist "scoro-md-%VERSION%.zip" del "scoro-md-%VERSION%.zip"
powershell -Command "Compress-Archive -Path 'scoro-md-%VERSION%' -DestinationPath 'scoro-md-%VERSION%.zip'"
cd ..

echo Local release created successfully!
echo Release file: releases\scoro-md-%VERSION%.zip

if "%OPTION%"=="2" goto :github
goto :end

:github
echo.
echo Triggering GitHub workflow...

REM Verify that git is available
git --version > nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo Git is not available. Please install Git and try again.
  goto :end
)

REM Check if we're in a git repository
git rev-parse --is-inside-work-tree > nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo Not inside a git repository. Please run this script from a git repository.
  goto :end
)

REM Check if there are any uncommitted changes
git diff-index --quiet HEAD --
if %ERRORLEVEL% NEQ 0 (
  echo There are uncommitted changes. Please commit all changes before creating a release.
  set /p CONTINUE="Continue anyway? (y/n): "
  if /i not "%CONTINUE%"=="y" goto :end
)

REM Create and push the tag
echo Creating git tag v%VERSION%...
git tag -a v%VERSION% -m "Release v%VERSION%"
if %ERRORLEVEL% NEQ 0 (
  echo Failed to create tag.
  goto :end
)

echo Pushing tag to remote repository...
git push origin v%VERSION%
if %ERRORLEVEL% NEQ 0 (
  echo Failed to push tag. Tag was created locally but not pushed.
  echo You can push it manually with: git push origin v%VERSION%
  goto :end
)

echo GitHub workflow triggered successfully!
echo GitHub will now build and publish the release.
echo Check the Actions tab on GitHub to monitor progress.

:end
echo.
echo Release process completed. 