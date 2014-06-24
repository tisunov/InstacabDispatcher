# config valid only for Capistrano 3.1
lock '3.1.0'

# Deploying Node applications with Capistrano, GitHub, Nginx and Upstart
# http://www.technology-ebay.de/the-teams/mobile-de/blog/deploying-node-applications-with-capistrano-github-nginx-and-upstart.html

set :application, 'dispatcher'
set :repo_url, 'git@bitbucket.org:tisunov/dispatcher.git'
set :repository, 'origin'

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

  desc 'Stop dispatcher'
  task :stop do
    on roles(:app), in: :sequence do
      execute '/etc/init.d/forever', "stop"
    end
  end

  desc 'Start dispatcher'
  task :start do
    on roles(:app), in: :sequence do
      execute '/etc/init.d/forever', "start"
    end
  end

  desc 'Restart dispatcher'
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

  # Capistrano task so I don't have manually do git push before cap deploy. 
  # It includes some error checking to make sure I'm on the right branch (master) and haven't got any uncommitted changes
  desc "Push local changes to Git repository"
  task :push do
    # Check for any local changes that haven't been committed
    # Use 'cap deploy:push IGNORE_DEPLOY_RB=1' to ignore changes to this file (for testing)
    status = %x(git status --porcelain).chomp
    if status != ""
      if status !~ %r{^[M ][M ] config/deploy.rb$}
        raise "Local git repository has uncommitted changes"
      elsif !ENV["IGNORE_DEPLOY_RB"]
        # This is used for testing changes to this script without committing them first
        raise "Local git repository has uncommitted changes (set IGNORE_DEPLOY_RB=1 to ignore changes to deploy.rb)"
      end
    end
  
    # Check we are on the master branch, so we can't forget to merge before deploying
    branch = %x(git branch --no-color 2>/dev/null | sed -e '/^[^*]/d' -e 's/* \\(.*\\)/\\1/').chomp
    if branch != "master" && !ENV["IGNORE_BRANCH"]
      raise "Not on master branch (set IGNORE_BRANCH=1 to ignore)"
    end
  
    # Push the changes
    if ! system "git push #{fetch(:repository)} master"
      raise "Failed to push changes to #{fetch(:repository)}"
    end
  end

end

if !ENV["NO_PUSH"]
  before "deploy", "deploy:push"
end

namespace :fake_driver do
  desc 'Start fake driver'
  task :start do
    on roles(:app), in: :sequence do
      within release_path do
        execute '/usr/local/bin/forever', "start driver-app.js"
      end
    end
  end

  desc 'Stop fake driver'
  task :stop do
    on roles(:app), in: :sequence do
      within release_path do
        execute '/usr/local/bin/forever', "stop driver-app.js"
      end
    end
  end

  desc 'Restart fake driver'
  task :restart do
    on roles(:app), in: :sequence do
      within release_path do
        execute '/usr/local/bin/forever', "restart driver-app.js"
      end
    end
  end
  # after "deploy:publishing", :restart_fake_driver
end