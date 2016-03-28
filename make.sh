#!/bin/sh

appname=no-duplicated-authentication

cp buildscript/makexpi.sh ./
./makexpi.sh -n $appname -o
rm ./makexpi.sh

