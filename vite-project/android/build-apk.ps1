$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat :app:clean :app:assembleDebug
if ($?) {
    Start-Process ".\app\build\outputs\apk\debug\"
}
