pipeline {
    agent any

    environment {
        DEPLOY_DIR  = '/var/www/translan_data'
        SERVICE     = 'translan_data'
    }

    options {
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                echo "Branch: ${env.GIT_BRANCH} — Build #${env.BUILD_NUMBER}"
            }
        }

        // ── Backend deploy (local — Jenkins runs on the same server) ─────────
        stage('Deploy Backend') {
            steps {
                sh '''
                    set -e
                    cd /var/www/translan_data
                    echo "Pulling latest code..."
                    git pull origin main

                    echo "Installing Python dependencies..."
                    cd /var/www/translan_data/backend
                    source venv/bin/activate
                    pip install -q --upgrade pip
                    pip install -q -r requirements.txt

                    echo "Restarting service..."
                    systemctl restart translan_data
                    sleep 3
                    systemctl is-active --quiet translan_data
                    echo "Service is running."
                '''
            }
        }

        // ── Health check ──────────────────────────────────────────────────────
        stage('Health Check') {
            steps {
                sh '''
                    sleep 3
                    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8100/health)
                    echo "Health check status: $STATUS"
                    if [ "$STATUS" != "200" ]; then
                        echo "Health check FAILED"
                        exit 1
                    fi
                    echo "Health check passed."
                '''
            }
        }

        // ── APK build (EAS cloud) ─────────────────────────────────────────────
        stage('Build APK') {
            steps {
                dir('mobile') {
                    sh 'npm install --legacy-peer-deps'
                    withCredentials([string(credentialsId: 'expo-token', variable: 'EXPO_TOKEN')]) {
                        sh 'EXPO_TOKEN=$EXPO_TOKEN npx eas-cli build --platform android --profile preview --non-interactive --no-wait'
                    }
                }
            }
        }
    }

    post {
        success {
            echo "Deploy successful. API: http://173.212.220.11/translan_data/"
            echo "APK: check https://expo.dev for the download link."
        }
        failure {
            echo "Pipeline FAILED. Check the stage logs above."
        }
        always {
            cleanWs()
        }
    }
}
