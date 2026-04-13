pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '5'))
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                echo "Building APK — Build #${env.BUILD_NUMBER}"
            }
        }

        stage('Install dependencies') {
            steps {
                dir('mobile') {
                    sh 'npm ci'
                }
            }
        }

        stage('Build APK (EAS)') {
            steps {
                dir('mobile') {
                    withCredentials([string(credentialsId: 'expo-token', variable: 'EXPO_TOKEN')]) {
                        sh '''
                            npx eas-cli build \
                              --platform android \
                              --profile preview \
                              --non-interactive \
                              --no-wait
                        '''
                    }
                }
            }
        }
    }

    post {
        success {
            echo "APK build triggered. Check https://expo.dev for the download link."
        }
        failure {
            echo "Build FAILED. Check console output above."
        }
        always {
            cleanWs()
        }
    }
}
