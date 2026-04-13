pipeline {
    agent any

    environment {
        EXPO_TOKEN = credentials('expo-token')  // Jenkins credential — see DEPLOYMENT.md §6
    }

    options {
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '5'))
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                echo "Building APK from branch: ${env.BRANCH_NAME ?: 'main'} — Build #${env.BUILD_NUMBER}"
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

    post {
        success {
            echo "APK build triggered successfully. Check https://expo.dev for the download link."
        }
        failure {
            echo "Build FAILED. Check console output above."
        }
        always {
            cleanWs()
        }
    }
}
