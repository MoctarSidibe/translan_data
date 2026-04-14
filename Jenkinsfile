// Jenkins on 37.60.240.199 — APK build only.
// Backend deployment is handled by Coolify on 173.212.220.11.

pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                echo "APK Build — ${env.GIT_BRANCH} #${env.BUILD_NUMBER}"
            }
        }

        stage('Install dependencies') {
            steps {
                dir('mobile') {
                    sh 'npm install --legacy-peer-deps'
                }
            }
        }

        stage('Build APK') {
            steps {
                dir('mobile') {
                    withCredentials([string(credentialsId: 'expo-token', variable: 'EXPO_TOKEN')]) {
                        sh 'EXPO_TOKEN=$EXPO_TOKEN npx eas-cli build --platform android --profile preview --non-interactive --no-wait'
                    }
                }
            }
        }
    }

    post {
        success {
            echo "APK build triggered. Download at https://expo.dev"
        }
        failure {
            echo "Build FAILED. Check console output above."
        }
        always {
            cleanWs()
        }
    }
}
