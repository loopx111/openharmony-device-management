@echo off
echo 清理HBuilderX打包缓存...

REM 清理HBuilderX的Android打包缓存
if exist "%USERPROFILE%\AppData\Local\HBuilder X\AndroidPackWork\cache\__UNI__61BAEF7" (
    rmdir /s /q "%USERPROFILE%\AppData\Local\HBuilder X\AndroidPackWork\cache\__UNI__61BAEF7"
    echo 已清理缓存目录: __UNI__61BAEF7
)

if exist "%USERPROFILE%\AppData\Local\HBuilder X\AndroidPackWork\cache\__UNI__ADSCREENPLAYER001" (
    rmdir /s /q "%USERPROFILE%\AppData\Local\HBuilder X\AndroidPackWork\cache\__UNI__ADSCREENPLAYER001"
    echo 已清理缓存目录: __UNI__ADSCREENPLAYER001
)

REM 清理项目内的unpackage缓存
if exist "unpackage" (
    rmdir /s /q "unpackage"
    echo 已清理项目缓存目录: unpackage
)

REM 清理临时文件
if exist "%USERPROFILE%\AppData\Local\Temp\brut_util_Jar_*" (
    del /q "%USERPROFILE%\AppData\Local\Temp\brut_util_Jar_*"
    echo 已清理临时文件
)

echo.
echo 缓存清理完成！请重新打开HBuilderX并尝试打包。
pause