pipeline {
    agent any

    environment {
        SERVER_IP   = '173.212.220.11'
        SERVER_USER = 'root'
        DEPLOY_DIR  = '/var/www/translan_data'
        SERVICE     = 'translan_data'
        SSH_CRED_ID = 'translan-server-ssh'  // Jenkins credential ID
    }

    options {
        ansiColor('xterm')
        timestamps()
        timeout(time: 20, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                echo "Branch: ${env.BRANCH_NAME ?: 'main'} — Build #${env.BUILD_NUMBER}"
            }
        }

        stage('Lint & Syntax Check') {
            parallel {
                stage('Python syntax') {
                    steps {
                        sh '''
                            python3 -m py_compile backend/main.py
                            python3 -m py_compile backend/app/core/config.py
                            python3 -m py_compile backend/app/database.py
                            echo "Python syntax OK"
                        '''
                    }
                }
                stage('requirements.txt exists') {
                    steps {
                        sh 'test -f backend/requirements.txt && echo "requirements.txt found"'
                    }
                }
            }
        }

        stage('Deploy to Server') {
            when {
                branch 'main'
            }
            steps {
                sshagent(credentials: [env.SSH_CRED_ID]) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} '
                            set -e

                            echo "── Pulling latest code ──"
                            cd ${DEPLOY_DIR}
                            git fetch origin main
                            git reset --hard origin/main

                            echo "── Installing Python dependencies ──"
                            cd ${DEPLOY_DIR}/backend
                            source venv/bin/activate
                            pip install -q --upgrade pip
                            pip install -q -r requirements.txt

                            echo "── Restarting service ──"
                            systemctl restart ${SERVICE}
                            sleep 3
                            systemctl is-active --quiet ${SERVICE} && echo "Service is running" || (journalctl -u ${SERVICE} -n 30 && exit 1)
                        '
                    """
                }
            }
        }

        stage('Health Check') {
            when {
                branch 'main'
            }
            steps {
                sh """
                    sleep 5
                    STATUS=\$(curl -s -o /dev/null -w "%{http_code}" http://${SERVER_IP}/translan_data/health)
                    if [ "\$STATUS" = "200" ]; then
                        echo "Health check passed (HTTP 200)"
                    else
                        echo "Health check FAILED (HTTP \$STATUS)"
                        exit 1
                    fi
                """
            }
        }
    }

    post {
        success {
            echo "Deployment successful — http://${SERVER_IP}/translan_data/"
        }
        failure {
            echo "Deployment FAILED. Check logs above."
        }
        always {
            cleanWs()
        }
    }
}
