setlocal
set appname=no-duplicated-proxy-authentication

copy buildscript\makexpi.sh .\
bash makexpi.sh -n %appname% -o
del makexpi.sh
endlocal
