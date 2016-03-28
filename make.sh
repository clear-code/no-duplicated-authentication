#!/bin/sh

appname=no-duplicated-proxy-authentication

cp buildscript/makexpi.sh ./
./makexpi.sh -n $appname -o
rm ./makexpi.sh

