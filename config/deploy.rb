# config valid only for Capistrano 3.1
lock '3.1.0'

# Deploying Node applications with Capistrano, GitHub, Nginx and Upstart
# http://www.technology-ebay.de/the-teams/mobile-de/blog/deploying-node-applications-with-capistrano-github-nginx-and-upstart.html

set :application, 'dispatcher'
set :repo_url, 'git@bitbucket.org:tisunov/dispatcher.git'

# Default deploy_to directory is /var/www/my_app
set :deploy_to, "/home/deploy/apps/dispatcher"

set :user, "deploy"

set :scm, :git

# Default value for :format is :pretty
# set :format, :pretty

# Default value for :log_level is :debug
# set :log_level, :debug

# Default value for :pty is false
# set :pty, true

# Default value for :linked_files is []
# set :linked_files, %w{config/database.yml}

# Default value for linked_dirs is []
# set :linked_dirs, %w{bin log tmp/pids tmp/cache tmp/sockets vendor/bundle public/system}

# Default value for default_env is {}
# set :default_env, { path: "/opt/ruby/bin:$PATH" }

set :app_command, "app.js"

set :default_env, {
  'NODE_ENV' => 'production'
}

# Default value for keep_releases is 5
# set :keep_releases, 5

namespace :deploy do

  desc 'Restart application'
  task :restart do
    on roles(:app), in: :sequence do
      execute '/etc/init.d/forever', "restart"
    end
  end
  after :publishing, :restart

  desc "Install node modules non-globally"
  task :npm_install do
    on roles(:app), in: :sequence, wait: 5 do
      within release_path do
        execute :npm, "install"
      end
    end
  end  
  after :updated, :npm_install
end
