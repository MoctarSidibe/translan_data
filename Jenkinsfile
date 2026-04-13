pipeline {
    agent any

    environment {
        APP_SERVER    = '173.212.220.11'
        DEPLOY_DIR    = '/var/www/translan_data'
        SERVICE       = 'translan_data'
        SSH_CRED_ID   = 'translan-deploy-key'   // Jenkins credential ID
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

        // ── Backend deploy ──────────────────────────────────────────────────
        stage('Deploy Backend') {
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
                    sh """
                        ssh -i \$SSH_KEY -o StrictHostKeyChecking=no root@${APP_SERVER} '
                            set -e
                            cd ${DEPLOY_DIR}
                            echo "Pulling latest code..."
                            git pull origin main

                            echo "Installing Python dependencies..."
                            cd ${DEPLOY_DIR}/backend
                            source venv/bin/activate
                            pip install -q --upgrade pip
                            pip install -q -r requirements.txt

                            echo "Restarting service..."
                            systemctl restart ${SERVICE}
                            sleep 3
                            systemctl is-active --quiet ${SERVICE}
                            echo "Service is running."
                        '
                    """
                }
            }
        }

        // ── Health check ────────────────────────────────────────────────────
        stage('Health Check') {
            steps {
                sh """
                    sleep 3
                    STATUS=\$(curl -s -o /dev/null -w "%{http_code}" http://${APP_SERVER}/translan_data/health)
                    echo "Health check HTTP status: \$STATUS"
                    if [ "\$STATUS" != "200" ]; then
                        echo "Health check FAILED"
                        exit 1
                    fi
                    echo "Health check passed."
                """
            }
        }

        // ── APK Build ───────────────────────────────────────────────────────
        stage('Build APK') {
            steps {
                dir('mobile') {
                    sh 'npm install --legacy-peer-deps'
                    sh 'npx eas-cli build --platform android --profile preview --non-interactive --no-wait'
                }
            }
        }
    }

    post {
        success {
            echo "Deploy + APK build triggered successfully."
            echo "API: http://${APP_SERVER}/translan_data/"
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
