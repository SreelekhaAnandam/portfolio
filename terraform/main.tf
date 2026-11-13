provider "aws" {
  region = "us-east-1"
}

resource "aws_security_group" "portfolio_sg" {
  name        = "portfolio_sg"
  description = "Allow HTTP, HTTPS, and SSH"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "portfolio_server" {
  ami           = "ami-0c7217cdde317cfec" # Ubuntu 22.04 LTS (Adjust region as needed)
  instance_type = "t2.micro"
  key_name      = "your-aws-keypair-name"
  security_groups = [aws_security_group.portfolio_sg.name]

  tags = {
    Name = "Portfolio-EC2-Server"
  }
}

output "public_ip" {
  value = aws_instance.portfolio_server.public_ip
}